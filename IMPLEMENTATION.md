# 🚀 AI SOC & Wazuh Alert Management System Implementation Plan

เอกสารแผนการดำเนินงานสำหรับการปรับปรุงระบบ **Wazuh Dashboard** เพื่อลด Alert Fatigue และการพัฒนาระบบต่อยอดไปสู่ **AI SOC (Local LLM Integration)**

---

## 📅 Roadmap Overview

```text
[Phase 1: UI & Alert Remediation] ➔ [Phase 2: Grouping & State] ➔ [Phase 3: AI SOC Architecture]
```

---
## หมายเหตุ Design ทั้งหมดที่จะเพิ่มให้ใช้แบบ เดียวกับของเดิมที่ใช้งานอยู่ tailadmin
## 🛠️ Phase 1: Severity Mapping & UI/UX Redesign
> **เป้าหมาย:** แก้ปัญหา Alert Fatigue ปรับปรุงโครงสร้าง Visual Hierarchy ให้มองเห็นภัยคุกคามได้ง่าย

* [ ] **Severity Level Mapping (Wazuh ➔ 4 Levels)**
  * 🔴 **Critical (Level 12–16):** Red (`#DC2626`) — ต้องจัดการทันที (Rootkit, Ransomware)
  * 🟠 **High (Level 7–11):** Orange (`#EA580C`) — ตรวจสอบด่วน (Brute Force, FIM Critical)
  * 🟡 **Medium (Level 4–6):** Amber (`#D97706`) — เฝ้าระวัง (Login Failed, Config Change)
  * 🟢 **Low (Level 1–3):** Blue (`#2563EB`) — Info/Routine Log (PAM Session Open/Close, Sudo Executed)
* [ ] **UI Layout Refactoring**
  * **Top Summary Cards:** แสดงจำนวน Open Alerts แบ่งตาม Severity (Critical, High, Medium, Low)
  * **Badges & Indicators:** ใส่ Badge สีตรง Severity และ Agent Group ในตาราง
  * **Detail Drawer Side Panel:** คลิกบรรทัดในตารางเพื่อเปิดดู Raw Log, Full Payload และ Recommended Action
* [ ] **Noise Reduction**
  * เพิ่ม Toggle Switch *"Hide Low Severity / Info Logs"* บน Top Toolbar

---

## 🔄 Phase 2: Action State Machine & Filtering Controls
> **เป้าหมาย:** จัดการ State การทำงาน ป้องกันการกด Action ผิดพลาด และจัดกลุ่ม Agent

### 1. Action State Transition Logic
รองรับการย้อนกลับ State (Undo/Reopen) กรณีเจ้าหน้าที่กดรับเรื่องหรือปิดเคสผิดพลาด

```text
[ Open ] ──( Acknowledge )──► [ Acknowledged ] ──( Resolve )──► [ Resolved ]
   ▲                               │                                │
   └───────────( Reopen / Undo )───┴──────────( Reopen )────────────┘
```

* [ ] **Action Buttons by Status:**
  * **Status = `Open`:** แสดงปุ่ม `[ Acknowledge ]` `[ Resolve ]`
  * **Status = `Acknowledged`:** แสดงปุ่ม `[ Resolve ]` `[ Reopen ]`
  * **Status = `Resolved`:** แสดงปุ่ม `[ Reopen ]`
* [ ] **Transient Undo System:**
  * แสดง Toast / Snackbar เป็นเวลา 5 วินาทีหลังทำ Action พร้อมปุ่ม `[ Undo ]` เพื่อสลับ State กลับทันที

### 2. Grouping & Agent Group Filters
* [ ] **Agent Group Filter Control:**
  * เพิ่ม Multi-select Dropdown เลือกแสดงผลตาม Agent Group (เช่น `Core Servers`, `Database`, `Workstations`, `DMZ`)
* [ ] **Alert Aggregation (Deduplication):**
  * ทำ Grouping บรรทัด Alert ที่เกิดจาก Rule เดียวกัน + Agent เดียวกันในช่วงเวลาสั้นๆ (เช่น PAM Session 5501/5502) แล้วแสดงเป็น Badge ตัวเลขจำนวนครั้ง (e.g. `14x 🔥`)

---

## 🤖 Phase 3: AI SOC Integration (Local Model Integration)
> **เป้าหมาย:** ใช้ Local LLM วิเคราะห์ Incident, ประเมินความเสี่ยงร่วมกับ Context องค์กร และสรุปคำแนะนำ

```text
  [ Wazuh Alert Payload ]
            │
            ▼
┌─────────────────────────┐      RAG Lookup      ┌─────────────────────────┐
│ Ingest Engine (Backend) │ ───────────────────► │ Vector DB (Chroma/Qdrant│
└─────────────────────────┘                      │ Network Topology / SOPs)│
            │                                    └─────────────────────────┘
            ▼                                                 │
┌─────────────────────────────────────────────────────────────┘
│ Prompt Construction (Alert Data + Agent Group + Context)
└─────────────────────────┐
                          ▼
┌──────────────────────────────────────────────────────────┐
│ Local LLM Server (Ollama / vLLM: Qwen2.5 / DeepSeek-R1) │
└─────────────────────────┬────────────────────────────────┘
                          ▼
┌──────────────────────────────────────────────────────────┐
│ AI SOC Output (Summary + Root Cause + Remediation Script)│
└─────────────────────────┴────────────────────────────────┘
```

* [ ] **Local LLM Engine Setup**
  * ติดตั้ง **Ollama** หรือ **vLLM** บน GPU Server ในองค์กร
  * Deploy Model: `Qwen2.5-Coder` หรือ `Llama-3.1` (เน้นภาษาไทย, Code/Log Analysis และ Reasoning)
* [ ] **Context-Aware Prompt Pipeline**
  * รวม Field `agent.groups`, `rule.id`, `rule.level`, `full_log` และ Asset Context เข้าเป็น Structured Prompt
* [ ] **AI SOC Features on UI**
  * **AI Incident Triage:** สรุปเหตุการณ์สั้น 2–3 บรรทัดอัตโนมัติเมื่อเกิด Alert ระดับ High/Critical
  * **`[ 🤖 Analyze with AI ]` Button:** กดเพื่อเปิดดู Root Cause Analysis และ Command Checklist สำหรับแก้ไขปัญหา
  * **False Positive Auto-Tagging:** ใช้ AI ประเมิน Log ปริมาณมาก และแปะ Tag ช่วยคัดกรอง Noise

---

## 📊 Data Schema Reference

### Alert Item Data Model (JSON Structure)
```json
{
  "id": "alert-10024",
  "timestamp": "2026-08-04T15:20:00Z",
  "rule": {
    "id": 510,
    "description": "Host-based anomaly detection event (rootcheck)",
    "level": 7
  },
  "agent": {
    "id": "001",
    "name": "wazuh",
    "ip": "192.168.1.10",
    "groups": ["infrastructure", "core-servers"]
  },
  "severity_category": "High",
  "status": "open",
  "count": 1,
  "ai_analysis": {
    "summary": "พบพฤติกรรมผิดปกติระดับ Rootcheck บนเซิร์ฟเวอร์หลัก",
    "remediation": ["สแกน Process ผิดปกติด้วย chkrootkit", "ตรวจสอบการสิทธิ์ไฟล์ใน /etc/"]
  }
}
```
