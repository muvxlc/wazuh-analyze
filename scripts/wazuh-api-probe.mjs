// scripts/wazuh-api-probe.mjs — ตรวจทุก endpoint ที่แผนจะดึง จาก Wazuh 4.14.7 จริง (path/param แก้ตามที่ validate แล้ว)
// รัน: node scripts/wazuh-api-probe.mjs   (โหลด ./.env, บันทึก scripts/wazuh-api-probe.report.txt)
import { Agent, fetch } from "undici";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const BASE = process.env.WAZUH_API_URL, USER = process.env.WAZUH_USERNAME, PASS = process.env.WAZUH_PASSWORD;
const INSECURE = process.env.WAZUH_ALLOW_INSECURE_TLS === "true", CA = process.env.WAZUH_CA_PATH;
if (!BASE || !USER || !PASS) { console.error("ขาด WAZUH_API_URL/USERNAME/PASSWORD ใน .env"); process.exit(1); }
const dispatcher = INSECURE ? new Agent({ connect: { rejectUnauthorized: false } })
  : CA ? new Agent({ connect: { ca: readFileSync(CA) } }) : undefined;

const report = [];
const out = (s) => { console.log(s); report.push(s); };
const section = (t) => out(`\n=== ${t} ===`);
const results = [];
async function get(path, token) {
  const url = new URL(path, BASE);
  try {
    const res = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}` }, dispatcher });
    let body = ""; try { body = await res.text(); } catch {}
    let parsed; try { parsed = JSON.parse(body); } catch {}
    return { status: res.status, parsed, body };
  } catch (e) { return { status: 0, error: String(e?.cause?.code || e?.message || e) }; }
}
function summarize(r) {
  if (r.error) return `err:${r.error}`;
  const d = r.parsed?.data;
  if (Array.isArray(d?.affected_items)) return `${d.affected_items.length} items${d.total_affected_items!=null?`/${d.total_affected_items}`:""}`;
  if (d && typeof d === "object") return "obj{" + Object.keys(d).slice(0,4).join(",") + "}";
  return r.parsed?.message || (r.body||"").slice(0,80);
}
function log(label, r) {
  const ok = r.status >= 200 && r.status < 300;
  const mark = ok ? "✅" : r.status === 0 ? "❌" : "⚠️";
  const err = r.parsed?.error ? ` ·err=${r.parsed.error}` : r.error ? ` ·err=${r.error}` : "";
  out(`  ${mark} [${r.status||"NET"}] ${label} → ${summarize(r)}${err}`);
  results.push({ label, status: r.status, ok });
  return r;
}
// expected-skip (ไม่นับเป็น failure)
function skip(label, r) {
  const ok = r.status === 404 || r.status === 400;
  out(`  ℹ️ [${r.status}] ${label} → ${summarize(r)} (expected skip)`);
  return r;
}

// ---------- AUTH ----------
section("AUTH");
let TOKEN = "";
try {
  const a = await fetch(new URL("/security/user/authenticate?raw=true", BASE), {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}` }, dispatcher });
  TOKEN = (await a.text().catch(()=> "")).trim();
  out(a.status === 200 && TOKEN ? `  ✅ token ได้ (${TOKEN.length} chars)` : `  ❌ auth ล้ม status=${a.status}`);
} catch (e) { out(`  ❌ auth exception: ${e?.cause?.code||e?.message}`); }
if (!TOKEN) { out("หยุด: auth ไม่ผ่าน"); writeFileSync("scripts/wazuh-api-probe.report.txt", report.join("\n")); process.exit(1); }

// ---------- pick REAL agent (not 000) ----------
section("หา active agent (ไม่ใช่ manager 000)");
const ag = await get("/agents?limit=500&offset=0", TOKEN); log("GET /agents", ag);
let agentId = "";
try {
  const items = ag.parsed?.data?.affected_items || [];
  const real = items.find(a => a.status === "active" && a.id !== "000") || items.find(a => a.id && a.id !== "000") || items[0];
  agentId = real?.id || ""; out(`  → ใช้ agent_id=${agentId||"NONE"} (${real?.name||"-"} / ${real?.status||"-"})`);
} catch {}

// ---------- global endpoints ----------
const globalProbes = [
  ["/agents/summary/status", "Health agents-summary"],
  ["/manager/status", "Health manager-status"],
  ["/manager/info", "Health manager-info"],
  ["/cluster/status", "Health cluster-status"],
  ["/mitre/techniques?limit=2", "MITRE techniques (list)"],
  ["/rules/requirement/pci_dss?limit=1", "Compliance pci_dss"],
  ["/rules/requirement/gdpr?limit=1", "Compliance gdpr"],
  ["/rules/requirement/hipaa?limit=1", "Compliance hipaa"],
  ["/rules/requirement/nist-800-53?limit=1", "Compliance nist-800-53"],
  ["/rules/requirement/tsc?limit=1", "Compliance tsc"],
  ["/lists?limit=50", "Lists (CDB index)"],
];

// ---------- per-agent ----------
const perAgent = (id) => id ? [
  [`/syscheck/${id}?limit=5`, "FIM/syscheck"],
  [`/rootcheck/${id}?limit=5`, "Malware/rootcheck"],
  [`/sca/${id}`, "SCA"],
  [`/syscollector/${id}/processes?limit=5`, "IT-Hygiene processes"],
  [`/syscollector/${id}/ports?limit=5`, "IT-Hygiene ports"],
  [`/syscollector/${id}/packages?limit=5`, "IT-Hygiene packages"],
  [`/syscollector/${id}/services?limit=5`, "IT-Hygiene services"],
  [`/syscollector/${id}/users?limit=5`, "IT-Hygiene users"],
  [`/syscollector/${id}/groups?limit=5`, "IT-Hygiene groups"],
  [`/syscollector/${id}/hardware`, "IT-Hygiene hardware"],
  [`/syscollector/${id}/hotfixes?limit=5`, "IT-Hygiene hotfixes"],
  [`/syscollector/${id}/netiface?limit=5`, "IT-Hygiene netiface"],
  [`/syscollector/${id}/netproto?limit=5`, "IT-Hygiene netproto"],
  [`/syscollector/${id}/netaddr?limit=5`, "IT-Hygiene netaddr"],
  [`/syscollector/${id}/os`, "IT-Hygiene os"],
  [`/syscollector/${id}/browser_extensions?limit=5`, "IT-Hygiene browser_ext"],
] : [];

const probes = [...globalProbes, ...perAgent(agentId)];
let inHygiene = false;
for (const [path, mod] of probes) {
  if (mod.startsWith("IT-Hygiene") && !inHygiene) { section("IT HYGIENE / syscollector"); inHygiene = true; }
  if (!mod.startsWith("IT-Hygiene")) inHygiene = false;
  log(`[${mod}] GET ${path}`, await get(path, TOKEN));
}

// ---------- expected-skip (vuln ไม่มีใน 4.14.7 = ข้ามตามแผน; /agents/{id} = RBAC 404 ใช้ list) ----------
section("EXPECTED SKIP (ข้ามตามแผน — ไม่นับ failure)");
if (agentId) {
  skip(`GET /agents/${agentId} (RBAC 404 → ใช้ /agents list)`, await get(`/agents/${agentId}`, TOKEN));
  skip(`GET /vulnerability_detection/${agentId}/cves (vuln ไม่มี REST 4.14.7)`, await get(`/vulnerability_detection/${agentId}/cves`, TOKEN));
  skip(`GET /vulnerability/${agentId} (vuln legacy)`, await get(`/vulnerability/${agentId}`, TOKEN));
} else out("  ℹ️ ข้าม (ไม่มี agent)");

// ---------- LISTS content ----------
section("LISTS content (malicious-ioc)");
try {
  const lists = (await get("/lists?limit=50", TOKEN)).parsed?.data?.affected_items || [];
  const iocList = lists.map(i=>i.name||i.folder||"").find(n => /malicious|ioc/i.test(n));
  if (iocList) log(`GET /lists/files/${encodeURIComponent(iocList)}?limit=5`, await get(`/lists/files/${encodeURIComponent(iocList)}?limit=5`, TOKEN));
  else out(`  ℹ️ ไม่เจอ malicious-ioc list (lists ที่มี: ${lists.map(i=>i.name||i.folder).join(", ")})`);
} catch (e) { out(`  ⚠️ อ่าน list ไม่ได้: ${e?.message}`); }

// ---------- Threat Intel (AbuseIPDB + OTX) ----------
section("THREAT INTEL");
const ABKEY = process.env.ABUSEIPDB_API_KEY;
if (ABKEY) {
  const ti = await fetch("https://api.abuseipdb.com/api/v2/check?ipAddress=8.8.8.8&maxAge=90", { headers: { Key: ABKEY, Accept: "application/json" } });
  out(`  ${ti.ok?"✅":"❌"} [${ti.status}] AbuseIPDB /check`);
  if (ti.ok) { const j = await ti.json().catch(()=>({})); out(`      → 8.8.8.8 score=${j.data?.abuseConfidenceScore} reports=${j.data?.totalReports}`); }
  const bl = await fetch("https://api.abuseipdb.com/api/v2/blacklist?confidenceMinimum=90&limit=5", { headers: { Key: ABKEY, Accept: "application/json" } });
  out(`  ${bl.ok?"✅":"❌"} [${bl.status}] AbuseIPDB /blacklist`);
  if (bl.ok) { const j = await bl.json().catch(()=>({})); out(`      → blacklist ${(j.data||[]).length} ips (sample)`);
    results.push({label:"AbuseIPDB /check",status:ti.status,ok:ti.ok}); results.push({label:"AbuseIPDB /blacklist",status:bl.status,ok:bl.ok}); }
} else out("  ⏭️ ข้าม AbuseIPDB (ไม่มี ABUSEIPDB_API_KEY)");

// ---------- summary ----------
section("สรุป");
const ok = results.filter(r=>r.ok).length, bad = results.filter(r=>!r.ok);
out(`ผ่าน ${ok}/${results.length}`);
if (bad.length) { out("ไม่ผ่าน:"); bad.forEach(r=>out(`  · ${r.label} → ${r.status}`)); }
else out("🎉 ทุก endpoint ที่แผนจะใช้ผ่านหมด");
writeFileSync("scripts/wazuh-api-probe.report.txt", report.join("\n"));
out("\nบันทึกรายงาน → scripts/wazuh-api-probe.report.txt");
