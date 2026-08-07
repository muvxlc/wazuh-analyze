# SOC Incident Response Workflow

ภาพรวม manual + auto workflow ทั้งระบบ ทีละขั้นตอน

---

## ภาพรวม

ระบบมี 2 workflow:

1. **Auto workflow**
   - Webhook รับ Alert
   - สร้าง Alert
   - AI วิเคราะห์ผ่าน background queue
   - สร้าง Incident correlation อัตโนมัติเมื่อเข้าเงื่อนไข
   - ยังไม่สร้าง IR Case number อัตโนมัติ
   - ยังไม่ isolate host อัตโนมัติ

2. **Manual workflow**
   - Analyst เปิดผล AI
   - กด `Create IR Case`
   - ระบบสร้างเลข IR และรายละเอียดเคส
   - ระบบเสนอ isolation action
   - Manager/Admin กด Approve
   - Worker ส่งคำสั่งไป Wazuh
   - ทุก privileged action มี audit log

---

## 1. Alert เข้าระบบ

แหล่งข้อมูลส่ง webhook เข้า:

```text
POST /api/webhook/wazuh
```

ระบบทำงาน:

1. ตรวจ webhook secret/signature
2. ป้องกัน replay request
3. validate payload
4. บันทึกลง `alerts`
5. enqueue งาน AI ลง pg-boss queue:

```text
analyze-alert
```

6. ตอบ webhook กลับเร็ว ไม่รอ AI วิเคราะห์เสร็จ

```text
Webhook → alerts table → pg-boss
```

---

## 2. Auto AI Analysis

Daemon รับงานจาก queue:

```text
QUEUE_ANALYZE_ALERT
```

Worker ทำงาน:

1. โหลด Alert จาก DB
2. ตัดข้อมูลขนาดใหญ่ เช่น:
   - `full_log`
   - `previous_log`
   - `previous_output`
   - `netstat`
3. ลบ secret ที่อาจติดมาใน payload
4. จำกัดขนาด prompt
5. ส่งข้อมูลให้ LM Studio
6. อ่าน JSON verdict
7. ตรวจ schema
8. บันทึกผลลง `alert_analyses`

ผล AI มีข้อมูลประมาณนี้:

```json
{
  "summary": "...",
  "confidence": 0.8,
  "likelyFalsePositive": false,
  "severity": "high",
  "rootCause": "...",
  "observedEvidence": ["..."],
  "recommendedActions": ["..."],
  "mitreAttack": []
}
```

ถ้า LM Studio ตอบผิดรูปแบบ:

- parser ค้น JSON block ที่ valid
- ไม่เลือก JSON echo ของ Alert
- ถ้า parse ไม่ได้ บันทึก error
- ไม่สร้าง action
- ไม่ execute command

```text
pg-boss → LM Studio → validate verdict → alert_analyses
```

---

## 3. Auto Incident Correlation

หลัง Alert ถูกบันทึก ระบบ correlation ตรวจว่า Alert นี้เกี่ยวข้องกับ Incident เดิมหรือไม่ โดยดู:

- `agent_id`
- `rule_id`
- status
- เวลาที่เกิดเหตุ

### ถ้าเจอ Incident เดิม

ระบบ:

1. link Alert เข้า `incident_alerts`
2. เพิ่ม event ใน `incident_events`
3. ส่ง notification ตาม config
4. Incident เดิมยังไม่มีเลข IR ได้

### ถ้าไม่เจอ Incident เดิม

ระบบ:

1. สร้าง Incident ใหม่
2. ตั้ง status เป็น `open`
3. ตั้ง severity จาก Alert
4. link Alert เข้า Incident
5. เพิ่ม timeline event
6. ส่ง notification ถ้ามี rule

> **สำคัญ:** Auto correlation ≠ IR Case
>
> Auto correlation สร้าง Incident ทางเทคนิค แต่ยังไม่สร้างเอกสาร IR เต็มรูปแบบ และยังไม่เสนอ isolation action จาก AI verdict โดยอัตโนมัติ

---

## 4. Analyst เปิด Alert Analysis Panel

หน้า Alert มีปุ่ม:

```text
Analyze
Create IR Case
```

### กด Analyze

ถ้ายังไม่มีผลวิเคราะห์:

1. Browser เรียก:

```text
POST /api/alerts/:id/analysis
```

2. API ตรวจ session และ permission
3. โหลด Alert
4. เรียก AI แบบ synchronous
5. บันทึกผล AI
6. ส่ง verdict กลับ UI
7. UI แสดง:
   - Summary
   - Severity
   - Confidence
   - False Positive
   - MITRE ATT&CK
   - Recommended Actions

ส่วน auto daemon ก็ยังทำงานแยกได้ ถ้า Alert ถูก enqueue มาก่อนแล้ว

---

## 5. Analyst กด Create IR Case จาก Alert

ปุ่มนี้อยู่ใน Alert Analysis Panel

เงื่อนไข:

- ต้องมี AI verdict
- ต้องมี permission `incidents.manage`
- ต้องผ่าน CSRF/authentication

Browser เรียก:

```text
POST /api/alerts/:id/ir-case
```

ส่ง:

```json
{
  "verdict": {
    "summary": "...",
    "severity": "high",
    "observedEvidence": [],
    "recommendedActions": []
  }
}
```

API ทำงาน:

1. ตรวจ CSRF
2. ตรวจ session
3. ตรวจ permission
4. validate verdict ด้วย `aiVerdictSchema`
5. โหลด Alert
6. generate เลข IR
7. สร้าง Incident ใหม่
8. สร้าง structured description
9. link Alert เข้า `incident_alerts`
10. เพิ่ม event `open`
11. เขียน audit event `incident.create`
12. ถ้า verdict เป็น `high` หรือ `critical` และไม่ใช่ false positive:
    - หา source IP
    - สร้าง action proposal `firewall-drop`
13. ส่ง `incidentId` และ `incidentNumber` กลับ UI
14. UI redirect ไป:

```text
/incidents/:incidentId
```

เลขตัวอย่าง:

```text
IR260807001
```

รูปแบบ:

```text
IR + YYMMDD + running number
```

---

## 6. Structured IR Description

ระบบเก็บข้อมูลใน `incidents.description` เป็น text แบบ section:

```text
##Identification##
Source IP: ...
Destination IP: ...
Destination Port: ...
Protocol: ...
Agent: ...
Device: ...

##Threat Information##
AI Summary: ...
Severity: ...
Root Cause: ...

Evidence:
- ...
- ...

MITRE ATT&CK:
- T1071.001 (...)

##Solution/Workaround##
1) ...
2) ...
```

ข้อมูลต้นทางมาจาก:

- AI verdict
- Alert raw payload
- Wazuh decoder data
- agent metadata
- location
- source/destination IP
- destination port
- protocol

ระบบไม่เก็บ secret ลง description โดยตั้งใจ

---

## 7. Isolation Action Proposal

ระบบจะเสนอ action เฉพาะเมื่อ:

```text
severity = high หรือ critical
likelyFalsePositive != true
มี source IP
```

ตัวอย่าง action:

```text
command: firewall-drop
payload.arguments: [sourceIp]
payload.agents: [agentId]
status: proposed
```

เหตุผล:

```text
AI auto-proposed isolation for Source IP ...
```

> คำว่า `auto-proposed` หมายถึง AI เสนอ action ไม่ใช่ AI execute action

Action ถูกบันทึกในตาราง `actions` พร้อม audit event `action.propose`

ถ้าไม่มี source IP:

- สร้าง IR Case ได้
- ไม่สร้าง isolation proposal
- ไม่ส่ง command ใด ๆ

ถ้า actor ไม่มี `actions.propose`:

- สร้าง IR Case ได้
- proposal ถูก skip
- error ไม่ทำให้ case creation ล้ม

---

## 8. Analyst เปิด Incident Detail

หน้า Incident แสดง:

```text
[IR260807001] Suspicious C&C Traffic
```

แสดง:

- status
- severity
- created time
- linked alerts
- timeline
- notes
- actions

ถ้า Incident เดิมมาจาก auto correlation และยังไม่มีเลข IR ปุ่มนี้จะปรากฏ:

```text
Create IR Case (AI)
```

---

## 9. Create IR Case จาก Incidents Page

ปุ่มใน Incident Detail เรียก:

```text
POST /api/incidents/:id/draft
```

Route ทำงาน:

1. ตรวจ CSRF
2. ตรวจ session
3. assign `incidentNumber` ถ้ายังไม่มี
4. โหลด Incident detail ใหม่
5. ส่งข้อมูลกลับ UI

เลข IR ถูกสร้าง เช่น:

```text
IR260807002
```

### ข้อจำกัดปัจจุบัน

เส้นทางนี้เป็น **backfill เลข IR** เป็นหลัก

มันยังไม่ได้:

- เรียก AI ใหม่จาก linked alerts
- rewrite description จาก verdict ใหม่
- สร้าง isolation proposal จาก correlation
- สร้าง structured IR description เต็มรูปแบบให้ Incident เดิม

ดังนั้นปัจจุบันมีความต่าง:

| จุดกด | ผลลัพธ์ |
|---|---|
| Alert Analysis Panel | สร้าง Incident ใหม่ + description + link alert + เสนอ action |
| Incident Detail | เติมเลข IR ให้ Incident เดิม |

---

## 10. Approve Isolation

หน้า Incident แสดง actions ผ่าน `IncidentActions`

Action เริ่มต้น:

```text
proposed
```

ผู้มี permission ที่เหมาะสมกด Approve:

```text
POST /api/actions/:id/approve
```

ระบบ:

1. ตรวจ authentication
2. ตรวจ permission `actions.approve`
3. ตรวจ action status
4. บันทึก approval decision
5. เปลี่ยน action เป็น `approved`
6. เขียน audit event `action.approve`
7. enqueue execution job:

```text
execute-action
```

AI ไม่มีสิทธิ์ข้ามขั้นนี้

---

## 11. Execute Isolation

Daemon รับงาน:

```text
QUEUE_EXECUTE_ACTION
```

Worker:

1. โหลด action
2. ตรวจ action status ว่า approved
3. โหลด payload
4. ส่งไป Wazuh API:

```text
POST /active-response
```

ด้วย command:

```text
firewall-drop
```

และ arguments:

```text
[sourceIp]
```

5. ถ้าสำเร็จ:
   - status เป็น `executed`
   - audit event `action.execute`
6. ถ้าล้มเหลว:
   - action ไม่ถูกถือว่าสำเร็จ
   - บันทึก error
   - audit event มี failure detail ตามระบบเดิม

Flow ทั้งหมด:

```text
AI verdict
  ↓
action proposed
  ↓ analyst/manager approval
action approved
  ↓
pg-boss execute-action
  ↓
Wazuh active-response
  ↓
host/source IP blocked
```

---

## 12. Manual Incident Status Workflow

Incident status เปลี่ยนโดย analyst ผ่านหน้า Incident:

```text
open
  ↓
investigating
  ↓
mitigated
  ↓
resolved
```

แต่ละ transition:

1. ตรวจ permission `incidents.manage`
2. ตรวจ transition ว่าถูกต้อง
3. update Incident
4. เพิ่ม `incident_events`
5. เขียน audit event

ระบบไม่ให้ข้าม transition ที่ไม่อนุญาต

---

## 13. Audit Log

รายการสำคัญที่ audit:

- Incident create
- Incident status transition
- Action proposal
- Action approval
- Action rejection
- Action execution
- User/session privileged operations ตามระบบเดิม

Audit เก็บ metadata:

- actor user ID
- target type
- target ID
- action
- request ID
- IP
- user agent
- detail ที่จำเป็น

ไม่เก็บ:

- API key
- password
- session secret
- provider secret
- decrypted settings
- full credential payload

---

## สรุป Auto กับ Manual

### Auto ทำแล้ว

```text
Webhook รับ Alert
→ บันทึก Alert
→ enqueue AI analysis
→ LM Studio วิเคราะห์
→ บันทึก AI verdict
→ correlation สร้าง/link Incident
→ notification ตาม rule
```

### Manual ต้องมี Analyst

```text
เปิด verdict
→ กด Create IR Case
→ สร้างเลข IR
→ สร้าง structured IR draft
→ review evidence/recommendations
```

### Approval ต้องมี Manager/Admin หรือ role ที่ permission อนุญาต

```text
review proposed isolation
→ Approve
→ execute-action queue
→ Wazuh active-response
```

### AI ไม่ทำ

```text
ไม่ execute firewall-drop เอง
ไม่ approve action เอง
ไม่ isolate host เอง
ไม่เปลี่ยน Incident เป็น resolved เอง
```

### จุดที่ควรทำต่อ

`POST /api/incidents/:id/draft` ควรขยายให้ทำ structured AI draft และเสนอ isolation สำหรับ Incident ที่ correlation สร้างไว้ด้วย ตอนนี้ route เติมเลข IR อย่างเดียว
