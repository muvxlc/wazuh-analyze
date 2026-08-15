# Wazuh SOC AI — Implementation Plan

## Context

โปรเจกต์ worktree `.worktrees/nextjs-wazuh-dashboard/` คือ Next.js 16 dashboard รับ Wazuh alert ผ่าน webhook (HMAC) เก็บ PostgreSQL + Drizzle มี AI infra ครึ่งทาง (`ai_connections`, `analyzeAlert()`, `buildAlertAnalysisPrompt()` redact secret) **ยังไม่ต่อ route/UI** เป้าหมาย = **Wazuh SOC AI**: AI วิเคราะห์ + incidents + actions + notifications + metrics

เลือก **Path A: วิเคราะห์ใน dashboard (Next.js)** ไม่ทำ pipeline ฝั่ง Wazuh เพราะ reuse infra ที่มีทั้งหมด persist DB แสดง UI RBAC+audit 1 codebase

## Wazuh version + ขอบเขตข้อมูล (อ่าน spec จริง `spec-v4.14.7.yaml`)

**Wazuh 4.14.7** — ข้อมูล 3 เลเยอร์: (1) Event `alerts.json` [มี], (2) State/Inventory Wazuh REST API [ดึงเพิ่ม], (3) Indexer `wazuh-states-*` [ไม่ใช้]

Coverage จริงตาม spec:

| Module | REST API (4.14.7) | alerts.json | สถานะแผน |
|---|---|---|---|
| SCA | ✅ `/sca/{id}`, `/sca/{id}/checks/{policy}` | state-change | Phase 1 |
| Malware/rootcheck | ✅ `/rootcheck/{id}` | ✅ events | Phase 1 |
| FIM/syscheck | ✅ `/syscheck/{id}` | ✅ events | Phase 1 |
| **Vulnerability** | ❌ **ไม่มี endpoint** | state-change เท่านั้น | **ข้าม (เก็บ Phase 5 ใช้ Indexer)** |
| IT Hygiene syscollector | ✅ `/syscollector/{id}/{processes,ports,packages,services,users,groups,hardware,hotfixes,netiface,netproto,netaddr,os,browser_extensions}` + `/experimental/syscollector/*` | custom rule เท่านั้น | Phase 1 |
| MITRE | ✅ `/mitre/{techniques,tactics,groups,mitigations,software}` (reference) | mapping | Phase 1 |
| Compliance | ✅ `/rules/requirement/{pci_dss,gdpr,hipaa,nist-800-53,gpg13,tsc,mitre}` (**nist ขีดกลาง**) | mapping | Phase 1 |
| Agent/Manager/Cluster health | ✅ `/agents`, `/agents/summary/status`, `/manager/status`, `/cluster/healthcheck` | — | Phase 1 |
| Active response | ✅ `PUT /active-response` | — | Phase 5 |
| Threat Intel | VirusTotal=event integration + `/lists` malicious-ioc lookup | VT events | Phase 1 (AbuseIPDB) |

**หมายเหตุ Compliance (PCI/GDPR/HIPAA/NIST/TSC)** = 🏷️ mapping/tag ติดมากับ rule+SCA ไม่ใช่ feed แยก. posture จริง = aggregate SCA (REST) + mapping. **alert เดียว ≠ คำตัดสิน compliance**

## การตัดสินใจที่ล็็อก
- **Enrichment**: Wazuh REST API (4.14.7) + correlation กับ alerts ใน Postgres. **ไม่มี Elasticsearch ทั้งแผน**
- **Vulnerability Detection**: ข้ามรอบนี้ (ไม่มี REST ใน 4.14.7) — เก็บไว้ทำทีหลังด้วย Indexer
- **Threat Intelligence**: AbuseIPDB free tier **ฝั่ง dashboard** (IP reputation, cache+gate+blacklist-cache) + เปิด Wazuh VirusTotal integration (file hash, ไหลเป็น event มาเอง) + `/lists` IOC cross-ref. ไม่เขียน custom Wazuh script
- **Notifications**: Discord + Telegram
- **Actions**: MVP **recommend-only** (AI เสนอ คน execute); approve-gated + selective-auto ทำตอน final product (schema extend ไว้)
- **Writeback**: dashboard-native เท่านั้น ไม่ยิงกลับ Wazuh → ไม่ต้องทำ AI-loop prevention

## Probe validation ผ่านแล้ว (T-PROBE, `scripts/wazuh-api-probe.mjs`)

ยิงจริงกับ instance 4.14.7 (auth ✅, agent `001:mac-office2` active). ผลที่กระทบแผน:
- ✅ ใช้ได้มีข้อมูลจริง: SCA `/sca/{id}`, rootcheck `/rootcheck/{id}`(48), syscheck `/syscheck/{id}`(1940), syscollector ทั้ง 12 (processes44/ports69/packages377/services101/users28/groups56/hardware/netiface/netproto/netaddr/os), `/agents/summary/status`, `/manager/status`, `/manager/info`, `/lists`(7), compliance pci_dss(60)/gdpr(4)/hipaa(12)/tsc(17)
- ⚠️ แก้ path/param: compliance NIST = `nist-800-53` (ขีดกลาง) ไม่ใช่ `nist_800_53`; valid tokens = `pci_dss,gdpr,hipaa,nist-800-53,gpg13,tsc,mitre`. MITRE `/mitre/techniques` ใช้ได้แบบ list เท่านั้น (filter id ไม่ support) — rely on alert `rule.mitre`
- ❌ ตัดออกจากแผน: `/experimental/syscollector/*` (disabled err=1122), `/cluster/healthcheck` (standalone err=3013), `/vulnerability*` (404 ยืนยันข้าม), `/agents/{id}` (RBAC 404 → ใช้ `/agents` list)
- ✅ AbuseIPDB free-tier ผ่าน: `/check` (8.8.8.8 score=0/90 reports) + `/blacklist` (คืน IPs). probe รวม 30/30 ผ่านหมด

---

## Path A pros/cons

| ข้อดี | ข้อเสี​​ย |
|---|---|
| ไม่เพิ่ม infra — reuse Postgres/Drizzle/auth/RBAC/audit/Wazuh adapter/AI factory | analyst ฝั่ง Wazuh ไม่ login ไม่เห็น verdict (export รายงาน Phase 5) |
| ไม่มี writeback loop → ไม่ risk rule self-trigger, ไม่เสีย LLM tax ทุก event | correlation จำกัดที่ alert ที่ ingest (ไม่ cross-cluster) |
| AI verdict = DB row → dashboard/metrics/search ทำง่าย | enrichment freshness ขึ้น Wazuh REST latency |

**Risks → mitigation**
1. LLM latency/cost ตอน ingest → trigger default on-demand; auto เฉพาะ level≥7 + group filter + token cap + per-connection `timeoutMs`
2. `raw_payload` ใหญ่ → cap 32KB + redaction ใน `buildAlertAnalysisPrompt`; Phase 1 budget ~12KB
3. Wazuh API rate-limit/TLS-insecure → token-cache + `fetchWithTimeout`; cache syscollector/SCA per-agent 5 นาที; insecure TLS dev-only
4. LLM hallucinate MITRE/CVE → Zod strict; field ทุกตัว untrusted แสดงผลอย่างเดียว; validate รูปแบบ `technique_id` เท่านั้น
5. fire-and-forget job ตายตอน restart → `ponytail:` in-process; upgrade pg-boss (Phase 5)

---

## Phased Roadmap (MVP = Phase 0–4)

Critical path **0→1→2**. Phase 3,4 parallel หลัง 0

### Phase 0 — Foundations (wire AI, persist verdicts)

Analyst กด Analyze → AI คืน rich SOC verdict → เก็บ → แสดง

**Blocker วันแรก — bridge provider**: `analyzeAlert` (ใช้ `LocalAiProvider.analyze(prompt)`) ต้อง refactor เรียก `ChatProvider.chat(system, input, signal)` (จาก `createChatProvider`) ไม่งั้นรันไม่ได้

**New table** `src/server/db/schema/alert-analyses.ts` (+ re-export `schema/index.ts`), migration `drizzle/0007_alert_analyses.sql`:
- คอลัมน์: `id, alert_id(→alerts cascade), ai_connection_id(→ai_connections set null), provider, model, verdict(jsonb), tokens_used, latency_ms, enrichments_used(text[]), ioc_lookups(jsonb), created_by_user_id, created_at`
- index: `(alert_id, created_at desc)`, `(created_at desc)`
- cardinality **1:N append-only**, latest = `ORDER BY created_at DESC LIMIT 1` (`ponytail:` retention job ถมใหญ่)

**Extend schema** ใน `src/server/ai/analysis.ts`: `aiAnalysisSchema` → `aiVerdictSchema` (summary, eventType, severity, confidence, likelyFalsePositive, affectedAsset{}, observedEvidence[], correlation{}, mitreAttack[{techniqueId/techniqueName/tactic}], compliance, recommendedActions[], autoResponseAllowed, threatIntel{score,category}). เก็บ legacy `rootCause/remediation/falsePositive` optional ไว้ให้ test เดิมไม่แตะ. **เก็บ redaction + 32KB cap ไว้ทั้งหมด**

**New permission** `permissions.ts`: `alertsAnalyze: "alerts.analyze"` → role-defaults `super_admin`+`admin`

**New service** `src/server/ai/analyze-service.ts`: `runAlertAnalysis(db, actor, alertId, {connectionId, enrich}, metadata, config)` → `requirePermission` → `getAlertDetail` (reuse `alerts/query.ts`) → `resolveAiConnection` → `createChatProvider` → `analyzeAlert` → insert `alert_analyses` → `writeAuditEvent("alert.analyze")`

**New route** `src/app/api/alerts/[id]/analysis/route.ts` (clone `alerts/[id]/status/route.ts`): `POST`→201 verdict (perm `alerts.analyze`); `GET` list (perm `alerts.details`). CSRF `assertCsrfSafe`

**UI**: `AlertAnalysisPanel` (client island) ใน `src/components/alerts/alert-detail.tsx` — ปุ่ม Analyze + แสดง verdict (severity, confidence, MITRE chips, recommended_actions, falsePositive badge, threatIntel score). ส่ง `canAnalyze` จาก `[id]/page.tsx`

**Optional (ท้าย Phase 0 หลัง setting)**: enqueue-on-ingest ใน `integrations/wazuh/alerts/route.ts` — fire-and-forget `runAlertAnalysisAsync` (**เปิด pool ตัวเอง** `createDatabase()` เพราะ request pool ปิดใน `finally`; `finally pool.end()`) เมื่อ `inserted && level>=12 && config.socAutoAnalyze`. เพิ่ม `SOC_AUTO_ANALYZE`/`SOC_AUTO_ANALYZE_MIN_LEVEL` ใน `config.ts` (default off/12)

**Verification**: `analysis.test.ts` (extend — reject MITRE ผิดรูปแบบ, `.chat` mock), `analyze-service.test.ts` (permission denied/happy), route test, Playwright `tests/e2e/alert-analysis.spec.ts`

---

### Phase 1 — Context enrichment (Wazuh REST 4.14.7 + TI)

ก่อนเรียก LLM → ดึง related alerts (Postgres) + Wazuh inventory/SCA/FIM/mitre ตามประเภท + AbuseIPDB IOC, ภายใน token budget

- **Generalize Wazuh client** `src/server/wazuh/http-client.ts`: extract `wazuhGet(config, path, {timeoutMs, query})` ใช้ `authenticate`/`buildTlsOptions`/`fetchWithTimeout`. `fetchAgents` เรียกผ่านมัน. **เวอร์ชัน: probe `GET /manager/info` ตรวจ 4.14.7**
- **Fetchers** `src/server/wazuh/inventory.ts` (new) — endpoint ตาม spec 4.14.7:
  - `fetchAgentSca` → `/sca/{id}`
  - `fetchRootcheck` → `/rootcheck/{id}`
  - `fetchSyscheck` → `/syscheck/{id}`
  - `fetchProcesses/Ports/Packages/Services/Users/Groups/Hardware/Hotfixes/Netface/Netproto/Netaddr/Os` → `/syscollector/{id}/*`
  - `fetchMitreTechnique(id)` → `/mitre/techniques` (list; **filter `technique_id`/`techniques` ไม่ support ใน 4.14.7** — ใช้ list แล้ว match client-side หรือ skip เพราะ MITRE มากับ alert `rule.mitre` อยู่แล้ว)
  - `fetchAgentHealth` → `/agents` (list) + `/agents/summary/status`; `/agents/{id}` กับ agent `000` คืน 404 (special) → ใช้ list
  - **ไม่มี CVE fetcher** (vuln ข้าม — ยืนยัน 404 แล้ว)
  - **ไม่ใช้ `/experimental/syscollector/*`** (disabled ใน instance นี้ err=1122) — ใช้ per-agent `/syscollector/{id}/*` อย่างเดียว
  - **Health**: instance standalone (cluster disabled) → ใช้ `/manager/status` + `/agents/summary/status`; อย่าใช้ `/cluster/healthcheck` (400 err=3013)
  - แต่ละอัน cap ~2KB + redact; cache 5 นาที per agent (mirror `agent-cache.ts`)
- **Recipe** `src/server/enrichment/recipe.ts` (new): map `groups` → recipe. auth/sshd→relatedAlerts+health+processes; rootcheck/malware/yara→rootcheck+processes+ports; syscheck→syscheck; sca→sca; syscollector→processes+ports+packages+services
- **Correlate** `src/server/enrichment/correlate.ts` (new): SQL ใช้ index ที่มี (`alerts_agent_idx`, `alerts_wazuh_timestamp_idx`) หา alert อื่น same agent/rule 30 นาที limit 10. `ponytail:` srcip cross-host ทีหลัง (เพิ่ม generated `srcip_hash`)
- **Threat Intel** `src/server/ti/` (new) — **pluggable provider registry** (รองรับหลาย provider + optional key rotation ในรูปแบบเดียว):
  - `provider.ts`: interface `TiProvider { lookupIp(ip): Promise<TiVerdict|null> }` + registry + aggregator (`lookupIp` วนทุก provider, merge score, กิน cache ก่อน)
  - `abuseipdb.ts`: `GET /api/v2/check` (score/confidence/category) + `refreshBlacklist()` (`/blacklist?limit=10000` วันละครั้ง → `ioc_cache`)
  - `otx.ts`: AlienVault OTX `GET /api/v1/indicators/IPv4/{ip}/general` (pulse_count, reputation) — free, generous, ครอบ IP/hash/domain
  - `lookupIp(ip)` → ดู `ioc_cache` ก่อน (local ไม่จำกัด); miss → aggregator ถามทุก provider `Promise.allSettled` + cache ผลรวม (TTL 30 วัน)
  - gate: เช็กเฉพาะ `srcip` จาก `raw_payload.data.srcip` ของ alert level≥ threshold
  - **local blacklist 10k = unlimited lookup** (multiplier จริง ไม่พึ่ง API quota)
  - `ioc_cache` table: `indicator, type(ip|hash|domain), abuse_score, abuse_category, pulse_count, sources(text[]), fetched_at, ttl`
  - config: `TI_PROVIDERS` (default `abuseipdb,otx`), `ABUSEIPDB_API_KEY`, `OTX_API_KEY`(optional), `TI_MIN_LEVEL`, `TI_CACHE_TTL_DAYS`
  - `ponytail:` architecture รองรับหมุน key (`keys[]` round-robin/least-used) ถ้าจะใช้ — แต่ default 1 key/provider ตาม ToS; วอลลูมสูง → AbuseIPDB paid หรือเพิ่ม provider
- **Context builder** `src/server/enrichment/context-builder.ts` (new): `buildAnalysisContext` → fan-out `Promise.allSettled` (กลืน error), budget 12KB ตัดสัดส่วน, คืน `keys` + `iocLookups`
- **Wire**: `analyze-service.ts` เรียก builder เมื่อ `enrich!==false` → `buildAlertAnalysisPrompt(alert, context)` overload. เก็บ `enrichments_used` + `ioc_lookups` ใน `alert_analyses`
- **VirusTotal hash**: ไม่ต้องเขียน — ผู้ใช้เปิด Wazuh VT integration ฝั่ง Wazuh → event tag ไหลมาเป็น alert เอง; dashboard แค่อ่าน `raw_payload` VT fields. `/lists` cross-ref เป็น optional lookup ใน builder

**Verification**: inventory/recipe/context-builder/correlate/abuseipdb tests (mock fetch; rate-limit/quota error handling). `ponytail:` 5-min cache อาจ stale ระหว่างโจมตี — เพิ่ม `?nocache` ทีหลัง

---

### Phase 2 — Incidents

group alert → incident + lifecycle + detail + timeline

**New tables** `src/server/db/schema/incidents.ts`, migration `drizzle/0008_incidents.sql`:
- `incidents`: id, title, summary, severity(enum low/medium/high/critical), status(enum open/investigating/contained/resolved/closed), assignee_user_id, rule_id, agent_id, mitre_tactics(text[]), first_seen, last_seen, alert_count, ai_verdict(jsonb สำหรับ Phase 5), created_by/at, updated_at. index: status, severity, last_seen desc, (agent_id, rule_id)
- `incident_alerts`: incident_id, alert_id (unique), alert_id index (cascade)
- `incident_events`: id, incident_id, event_type, from/to_status, actor, occurred_at, metadata — mirror `alert_events`

**New permissions**: `incidents.read/list/manage` (`read`+`list` ให้ `user`; `manage` ให้ `admin`+`super_admin`)

**Correlator** `src/server/incidents/correlator.ts` (new): MVP rule = level≥7 + same `(agent_id, rule_id)` ภายใน 60 นาที + ≥2 matches → upsert incident (transaction `FOR UPDATE` กันซ้ำ เหมือน `transitionAlert`). Title rule-derived ราคาถูก; AI summary Phase 5. Trigger = ปุ่ม on-demand `POST /api/incidents/correlate`

**Workflow** `src/server/incidents/workflow.ts` (new): clone `alerts/workflow.ts` — matrix `open→investigating→contained→resolved→closed`, insert `incident_events`, `writeAuditEvent("incident.transition")`

**Routes** `src/app/api/incidents/`: `route.ts`(GET list/POST manual), `[id]/route.ts`(GET), `[id]/status/route.ts`(POST transition), `[id]/alerts/route.ts`(POST/DELETE link), `correlate/route.ts`(POST)

**UI**: `incidents/page.tsx`+`incidents-client.tsx` (clone `alerts-client.tsx`), `incidents/[id]/page.tsx`+`components/incidents/incident-detail.tsx` (timeline จาก `incident_events`). sidebar `workspaceItems` + i18n `messages/{en,th}.json`

**Verification**: correlator test+integration (dedup, concurrency), workflow matrix, route tests, Playwright `tests/e2e/incidents.spec.ts`

---

### Phase 3 — Notifications (Discord + Telegram)

**New tables** `src/server/db/schema/notifications.ts`, migration `drizzle/0009_notifications.sql`:
- `notification_channels`: id, name, type(enum discord/telegram), config(jsonb **encrypt** `encryptSecret` — `{webhookUrl}`|`{botToken,chatId}`), enabled, created_by/at, updated_at
- `notification_rules`: id, event_type (`alert.high_severity|incident.created|incident.escalated|verdict.confident_real`), severity_threshold, channel_id, enabled
- `notification_deliveries`: id, rule_id, channel_id, event_type, target_type/id, status(sent/failed), status_code, error, attempted_at (audit + retry surface Phase 5)

**New permission** `notifications.manage` → `admin`+`super_admin`

**Notifier** `src/server/notifications/notifier.ts` (new): factory → `DiscordNotifier`(POST `{content}` webhook cap 2000)/`TelegramNotifier`(POST `sendMessage`). undici + timeout

**Render** `src/server/notifications/render.ts` (new): event → `RenderedMessage{title, body, severity, url}` (deep link `${appUrl}/incidents/[id]`)

**Dispatcher** `src/server/notifications/dispatcher.ts` (new): `dispatchEvent(...)` → load rule + severity threshold → decrypt channel → render → deliver → insert delivery row + audit `notification.send`. isolate failure ต่อ channel

**Wire points**: `analyze-service.ts`(verdict `!likelyFalsePositive && confidence>=0.8`→`verdict.confident_real`), `correlator.ts`(incident created/escalated), ingest route(`level>=12`→`alert.high_severity`) — ทั้งหมด fire-and-forget pool ตัวเอง

**Routes** `src/app/api/notifications/`: `channels/`, `channels/[id]/`, `rules/`, `rules/[id]/`, `test/`(POST ส่งทดสอบ) — perm `notifications.manage`

**UI**: `settings/notifications/page.tsx` (channel CRUD + rule editor, sidebar `settings-notifications`) — reuse form pattern `settings/ai/page.tsx`

**Verification**: notifier/render/dispatcher tests + Playwright. `ponytail:` ไม่มี retry → sweep `status='failed'` Phase 5

---

### Phase 4 — SOC UX + metrics

**Dependency** เดียวในแผน: `npm i recharts` (ใช้ dataviz skill ก่อนเขียน chart)

**Metrics** `src/server/dashboard/soc-metrics.ts` (new) — จาก timestamp ที่มี (ไม่เพิ่มคอลัมน์):
- MTTD=`AVG(acknowledged_at-ingested_at)`, MTTR=`AVG(resolved_at-ingested_at)`
- False-positive rate = latest verdict per alert `likelyFalsePositive=true`
- Alerts over time = `date_trunc('hour', wazuh_timestamp)` group by level
- Top agents/rules/srcIP (`raw_payload->'data'->>'srcip'`)
- MITRE heatmap = aggregate `verdict->'mitreAttack'->>'tactic'` จาก `alert_analyses`
- Threat intel distribution = aggregate `ioc_lookups` abuse_score/-category
- Incident backlog = `status IN ('open','investigating')`

**Route** `GET /api/dashboard/soc?range=24h|7d|30d` perm `dashboard.read`

**UI** `dashboard/soc/page.tsx` + `components/dashboard/charts/` (SeverityTrend, AlertsOverTime, MitreHeatmap, TopN, MTTD/MTTR cards, FpRateGauge, IncidentBacklog, ThreatIntelDist). tab Overview/SOC

**Tuning UI** `settings/soc/page.tsx` — คุม `SOC_AUTO_ANALYZE`, min level, group allow/deny, token budget, AbuseIPDB gate. persist ผ่าน `system_settings` (reuse `updateSettings`, เพิ่ม key ใน `settings/types.ts`). config: `SOC_AUTO_ANALYZE`, `SOC_AUTO_ANALYZE_MIN_LEVEL`, `SOC_ANALYSIS_GROUP_ALLOW/DENY`, `ABUSEIPDB_*`

**Verification**: soc-metrics test (MTTD/MTTR/FPrate SQL), chart component tests, Playwright (render + range toggle)

---

### Phase 5 — Later (design-only ห้าม implement รอบนี้)

- **Vulnerability Detection**: เพิ่ม ES client อ่าน `wazuh-states-vulnerabilities-*` (ไม่มี REST ใน 4.14.7) — inventory CVE เต็ม + hunting ย้อนหลัง
- **Approval-gated + selective auto actions**: tables `actions`(proposed/approved/executed/rejected), `action_approvals`; perms `actions.propose/approve/execute`; execute ผ่าน `PUT /active-response`; `autoResponseAllowed` propose เท่านั้น
- **TI เพิ่ม**: VirusTotal dashboard-side (hash/domain), MISP, AbuseIPDB paid tier ถ้า unique IP >1k/day
- **Case management**: `case_notes` thread บน incident
- **Scheduled reports**: `reports` + pg-boss render PDF/HTML
- **Reliable job runner**: เปลี่ยน fire-and-forget ทั้งหมดเป็น **pg-boss** บน Postgres เดิม (upgrade ใหญ่สุด)
- **Cross-host srcip clustering**: generated column + index

---

## หลักการทำงานปลอดภัย (ไม่ทำลายระบบเดิม)

1. **Additive-first** — สร้างไฟล์/ตาราง/route/component ใหม่ก่อน. แก้ไฟล์เดิม = ขั้นสุดท้ายของแต่ละ phase (เฉพาะ wire-in)
2. **Migration เพิ่มอย่างเดียว** — `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE ADD COLUMN` เท่านั้น. ห้าม `DROP`/`ALTER` คอลัมน์เดิม (`alerts`, `alert_events`, `ai_connections`, `users`, `sessions` ฯลฯ). ทุกตารางใหม่ = migration ของตัวเอง (rollback ง่าย)
3. **Flag default-off** — behavior change ทุกตัว (auto-analyze, notification dispatch) อยู่หลัง setting/env default `off`. ระบบเดิมทำงานเหมือนเดิมเมื่อ flag ปิด
4. **Touch existing 2 จุดเท่านั้นต่อ phase** — (ก) schema/permission additive, (ข) wire-in สุดท้าย. ที่เหลือไฟล์ใหม่
5. **Checkpoint ทุก task**: `npx tsc --noEmit` + `npm run lint` + `npx vitest run <new/existing>` เขียว + app boot ได้. ไม่เขียว = หยุด ไม่ไปต่อ
6. **ทำใน worktree** (`.worktrees/nextjs-wazuh-dashboard/`) แยกจาก main อยู่แล้ว — isolate
7. **commit ทุก checkpoint** (ผู้ใช้สั่งเอง) — ถ้า task ทำลาย ย้อน commit เดียว

---

## Granular Task Breakdown

รูปแบบ task: **[NEW]/[MOD]** · ไฟล์ · ความเสี่ยง · checkpoint. 🟢=app เดิมไม่กระทบ 🟡=กระทบน้อย/มี flag 📍=จุดกลับไม่ได้

### Pre-implementation — Wazuh API validation (ทำก่อน Phase 0)

| # | Task | ไฟล์ | ความเสี่ยง | Checkpoint |
|---|---|---|---|---|
| **T-PROBE** | [NEW] `scripts/wazuh-api-probe.mjs` — spike ยิงจริงทุก endpoint ในแผน กับ Wazuh 4.14.7 จริง. auth (Basic→token), หยิบ active agent, probe SCA/rootcheck/syscheck/syscollector/*/mitre/lists/rules-requirement/agents/manager/cluster, ยืนยัน vuln=404, ทดสอบ AbuseIPDB key+quota | `scripts/wazuh-api-probe.mjs` (new, ไม่ import app code) | 🟢 สคริปต์รันแยก ไม่แตะระบบเดิม | output สรุป ✅/⚠️/❌ ทุก endpoint. **ผ่านเงื่อนไข**: auth ผ่าน + มี active agent + ≥80% syscollector endpoint มีข้อมูล. ใช้ผลปรับ Phase 1 recipe/fetcher ก่อนลงมือ |

**เหตุผล**: เจอปัญหาจริง (inventory ว่าง / path เปลี่ยน / quota / TLS) ก่อนเขียน code. ผลกำหนดว่า Phase 1 fetcher ไหนใช้ path/param อะไร, agent มีข้อมูลครบไหม

### Phase 0 — Foundations (10 tasks)

| # | Task | ไฟล์ | ความเสี่ยง | Checkpoint |
|---|---|---|---|---|
| **T0.0** | บันทึก baseline — รัน tsc/lint/vitest ทั้งชุด capture ผลเขียว, จำนวน test ผ่าน | — | 🟢 | ทุกอย่างเขียวก่อนเริ่ม. เก็บไว้เทียบทุก task |
| **T0.1** | [NEW] schema `alert_analyses` + re-export `schema/index.ts` + migration `drizzle/0007_alert_analyses.sql` | `src/server/db/schema/alert-analyses.ts` (new) | 🟢 | `npm run db:generate` → ตรวจ SQL มีแค่ CREATE → apply docker psql → `\d alert_analyses` เห็นคอลัมน์/index. app boot ปกติ (ตารางยังไม่มี code อ่าน) |
| **T0.2** | [MOD] extend `aiAnalysisSchema`→`aiVerdictSchema` (เพิ่ม field SOC) ใน `analysis.ts`; **เก็บ legacy `rootCause/remediation/falsePositive` optional** | `src/server/ai/analysis.ts`, `analysis.test.ts` | 🟡 | `analysis.test.ts` เดิมยังผ่าน + เพิ่มเคส reject MITRE ผิดรูปแบบ/accept rich verdict. tsc/lint เขียว |
| **T0.3** | [MOD] **bridge provider** — refactor `analyzeAlert` ใช้ `ChatProvider.chat(system,input,signal)` แทน `LocalAiProvider.analyze`. update mock `.analyze`→`.chat` | `src/server/ai/analysis.ts`, `analysis.test.ts` | 🟡 📍 | verify `createChatProvider` return `.chat` signature ตรงก่อนแก้. test mock คืน JSON string. tsc + vitest เขียว. **นี่คือจุดที่ AI เริ่มรันได้จริง** |
| **T0.4** | [MOD] permission `alertsAnalyze` + role-defaults (additive) | `permissions.ts`, `role-defaults.ts` | 🟢 | tsc เขียว. ไม่กระทบ perm เดิม |
| **T0.5** | [NEW] service `analyze-service.ts` (`runAlertAnalysis`) + test | `src/server/ai/analyze-service.ts` (new), `.test.ts` | 🟢 | vitest: permission denied throw, happy-path insert row+audit (mock provider+db). ยังไม่มี route เรียก |
| **T0.6** | [NEW] route `api/alerts/[id]/analysis` (GET list/POST analyze) + test | `src/app/api/alerts/[id]/analysis/route.ts` (new), `.test.ts` | 🟢 | route test 401/403/201/GET. endpoint ใหม่ ไม่แตะ route เดิม |
| **T0.7** | [MOD] UI — `AlertAnalysisPanel` (client island) embed ใน `alert-detail.tsx`; ส่ง `canAnalyze` จาก `[id]/page.tsx`. panel ยัง render ได้ถ้าไม่มี analysis | `src/components/alerts/alert-analysis-panel.tsx` (new), `alert-detail.tsx` (mod), `[id]/page.tsx` (mod) | 🟡 | alert detail เดิมยังโชว์ครบ; กด Analyze → เห็น verdict. Playwright `alert-analysis.spec.ts` |
| **T0.8** | [NEW] config `SOC_AUTO_ANALYZE`(off)/`SOC_AUTO_ANALYZE_MIN_LEVEL`(12) | `src/server/config.ts` | 🟢 | default off. app boot. env validation (`superRefine`) ผ่าน |
| **T0.9** | [MOD] wire enqueue-on-ingest หลัง flag — fire-and-forget **pool ตัวเอง** `createDatabase()`+`finally pool.end()`; gate `inserted && level>=12 && config.socAutoAnalyze` | `src/app/api/integrations/wazuh/alerts/route.ts` (mod) | 🟡 | flag off → ingest route ทำงานเหมือนเดิม byte-for-byte. flag on → analyze row เกิด. webhook เดิม 202 ไม่ช้า (async) |
| **T0.GATE** | **Phase 0 gate** — full `tsc`+`lint`+`vitest`+ Playwright + รัน app ทดสอบ Analyze flow จริง | — | — | baseline (T0.0) ยังเขียว + feature ใหม่ทำงาน. commit |

**Phase 0 ส่งมอบ**: ปุ่ม Analyze → verdict SOC ละเอียด → persist → แสดง. ระบบเดิมเหมือนเดิมเมื่อ flag ปิด

### Phase 1 — Enrichment + TI (task list)

- **T1.0** baseline gate (เหมือน T0.0)
- **T1.1** [MOD] generalize `wazuhGet(config,path,{timeoutMs,query})` ใน `http-client.ts`; `fetchAgents` เรียกผ่าน (refactor ไม่เปลี่ยน behavior) · 🟡 · เทส `fetchAgents` ยังผ่าน
- **T1.2** [NEW] `wazuh/inventory.ts` fetchers (sca/rootcheck/syscheck/syscollector/*/mitre/health) + TTL cache + test (mock fetch, URL assert, 404→null) · 🟢
- **T1.3** [NEW] `ioc_cache` migration + schema · 🟢
- **T1.4** [NEW] `ti/provider.ts` registry+aggregator, `ti/abuseipdb.ts`, `ti/otx.ts` + blacklist refresh + test (mock, quota error, cache hit/miss) · 🟢
- **T1.5** [NEW] `enrichment/recipe.ts` + `enrichment/correlate.ts` (SQL index ที่มี) + test · 🟢
- **T1.6** [NEW] `enrichment/context-builder.ts` (fan-out `allSettled`, budget 12KB) + test · 🟢
- **T1.7** [MOD] wire — `analyze-service.ts` เรียก builder; `buildAlertAnalysisPrompt(alert, context)` overload (เก็บ redaction/cap); route รับ `{enrich}` default true; เก็บ `enrichments_used`+`ioc_lookups` · 🟡 · analyze ยังทำงานได้แม้ enrich fail (fallback alert-only)
- **T1.GATE** full gate + ทดสอบ enrich จริงกับ Wazuh (ถ้ามี) หรือ mock · commit

### Phase 2 — Incidents (task list)

- **T2.0** baseline gate
- **T2.1** [NEW] `incidents`+`incident_alerts`+`incident_events` migration + schema · 🟢
- **T2.2** [MOD] permission `incidents.read/list/manage` + role-defaults · 🟢
- **T2.3** [NEW] `incidents/workflow.ts` (clone `alerts/workflow.ts` matrix) + test (no DB) · 🟢
- **T2.4** [NEW] `incidents/correlator.ts` (level≥7, same agent+rule, 60min, `FOR UPDATE`) + integration test (dedup/concurrency) · 🟢
- **T2.5** [NEW] routes `api/incidents/*` + tests · 🟢
- **T2.6** [NEW] UI `incidents/page`+`[id]/page`+`incident-detail` + sidebar + i18n · 🟡 (sidebar mod)
- **T2.7** [NEW] `POST /api/incidents/correlate` ปุ่ม on-demand · 🟢
- **T2.GATE** full gate + E2E correlate→incident→transition · commit

### Phase 3 — Notifications (task list)

- **T3.0** baseline gate
- **T3.1** [NEW] `notification_channels/rules/deliveries` migration + schema (config encrypt) · 🟢
- **T3.2** [MOD] permission `notifications.manage` · 🟢
- **T3.3** [NEW] `notifications/notifier.ts` (Discord+Telegram) + `render.ts` + test (mock fetch, 2000-char cap) · 🟢
- **T3.4** [NEW] `notifications/dispatcher.ts` (rule+severity filter, isolate failure, delivery row) + test · 🟢
- **T3.5** [NEW] routes `api/notifications/*` + `test/` + UI `settings/notifications` · 🟡 (sidebar mod)
- **T3.6** [MOD] wire dispatch — `analyze-service`(verdict confident), `correlator`(incident), ingest(`level>=12`) — ทั้งหมด fire-and-forget pool ตัวเอง, หลัง rules มีเท่านั้น · 🟡 · ไม่มี rule → ไม่ส่ง (silent, ไม่กระทบเดิม)
- **T3.GATE** full gate + สร้าง channel→POST /test→delivery row · commit

### Phase 4 — SOC UX + metrics (task list)

- **T4.0** baseline gate
- **T4.1** [MOD] `npm i recharts` (dep เดียว) · 🟡 · `npm run build` ผ่าน
- **T4.2** [NEW] `dashboard/soc-metrics.ts` (MTTD/MTTR/FPrate/topN/MITRE/TI/backlog) + test (seed rows) · 🟢
- **T4.3** [NEW] route `GET /api/dashboard/soc?range=` · 🟢
- **T4.4** [NEW] UI `dashboard/soc/page` + chart components (dataviz skill) + tab Overview/SOC · 🟡
- **T4.5** [MOD] tuning UI `settings/soc` (system_settings) + config keys · 🟢
- **T4.GATE** full gate + SOC dashboard render + range toggle · commit

### หมายเหตุ task
- ลำดับ T*.* คือลำดับทำ. แต่ละ task = 1 commit
- 🟢 ทำก่อนทั้งหมด (additive). 🟡 ทำทีหลัง (wire-in)
- ทุก GATE ต้อง baseline (T0.0) ยังเขียว — คำสั่งเทียบ: `npx vitest run 2>&1 | tail -40` ผ่านเท่าเดิม/มากกว่า
- หาก task ไหนทำแล้ว baseline แดง → ย้อน commit, แก้, ลองใหม่ ห้ามฝืนไปต่อ

---

## Full SOC feature map

| ความสามารถ | Phase | MVP? |
|---|---|---|
| Per-alert AI verdict (rich schema) | 0 | ✅ |
| Persist verdict history (1:N) | 0 | ✅ |
| ปุ่ม Analyze on-demand | 0 | ✅ |
| Enrichment (Wazuh REST 4.14.7 + PG) | 1 | ✅ |
| Threat Intel (AbuseIPDB + OTX + VT native + /lists) | 1 | ✅ |
| Incident grouping + lifecycle | 2 | ✅ |
| Notifications (Discord+Telegram) | 3 | ✅ |
| SOC dashboard + charts + MTTD/MTTR | 4 | ✅ |
| Tuning UI | 4 | ✅ |
| MITRE heatmap | 4 | ✅ |
| Auto-analyze on ingest (level≥7) | 0/5 | optional |
| **Vulnerability Detection inventory** | 5 | ❌ ข้าม (ไม่มี REST 4.14.7) |
| Approval/auto actions | 5 | later (recommend-only ตอนนี้) |
| Case management / Reports | 5 | later |
| Writeback to Wazuh | — | never |
| ES/Indexer | — | never (ยกเว้น vuln ทีหลัง) |

## Migration order (apply ผ่าน docker psql — `npm run db:migrate` แฮงก์)

`0007_alert_analyses.sql`(+`ioc_cache`) → `0008_incidents.sql` → `0009_notifications.sql`. generate SQL ด้วย `npm run db:generate` ตรวจก่อน apply. Phase 4/5 ไม่มี migration (reuse `system_settings`)

## Verification (end-to-end)

1. `npx tsc --noEmit`
2. `npx vitest run <focused> 2>&1 | tail -40` แต่ละ phase → full suite gate สุดท้าย
3. `npm run lint 2>&1 | tail -40`
4. `npm run db:generate` → ตรวจ SQL → apply docker psql → ตรวจ table/index
5. รัน app (`/run`): login → alert → Analyze → verdict (Phase 0); correlate→incident (Phase 2); SOC dashboard (Phase 4)
6. Playwright E2E ตามแต่ละ phase

## Critical files

- `src/server/ai/analysis.ts` — extend `aiVerdictSchema`, **bridge `.chat`** (blocker วันแรก), เก็บ redaction/cap
- `src/server/db/schema/alert-analyses.ts` (new) — template schema ทุกอัน
- `src/server/ai/analyze-service.ts` (new) — orchestration seam reuse ทุก phase
- `src/server/wazuh/http-client.ts` — generalize `wazuhGet` (seam Phase 1)
- `src/server/ti/` (new) — pluggable Threat Intel registry (AbuseIPDB + OTX) + `ioc_cache`
- `src/app/api/alerts/[id]/analysis/route.ts` (new) — first wired AI endpoint, template Phase 2-3
- `spec-v4.14.7.yaml` — แหล่งอ้างอิง endpoint ทั้งหมด
