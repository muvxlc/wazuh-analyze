"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { Languages } from "lucide-react";
import type { AiVerdict } from "../../server/ai/analysis";

interface QueueProgress {
  phase: string;
  status: string;
  detail?: string;
}

interface AlertAnalysisPanelProps {
  alertId: string;
  canAnalyze: boolean;
}

interface AnalysisItem {
  id: string;
  verdict: AiVerdict;
  createdAt: string;
}

export function AlertAnalysisPanel({ alertId, canAnalyze }: AlertAnalysisPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [creatingCase, setCreatingCase] = useState(false);
  const [caseMessage, setCaseMessage] = useState<string | null>(null);
  const [language, setLanguage] = useState<"en" | "th">("en");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    // ponytail: use polling interval; consider WebSockets for real-time updates when scale demands it
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/alerts/${alertId}/analysis`);
        if (!res.ok) return;
        const result = (await res.json()) as { data: AnalysisItem[]; progress?: QueueProgress };
        const { data, progress: prog } = result;
        setProgress(prog ?? null);
        if (data && data.length > 0 && data[0]) {
          setVerdict(data[0].verdict);
        }
        if (!prog || prog.status === "done" || prog.status === "error") {
          stopPolling();
          setLoading(false);
          if (prog?.status === "error") {
            const detail = prog.detail ?? "";
            if (detail.startsWith("ai_response_timeout")) {
              setError("AI model exceeded analysis timeout. Increase AI connection timeout or check model server logs.");
            } else if (detail.startsWith("ai_response_invalid")) {
              setError("AI response could not be parsed. Try a more capable model or check AI server logs.");
            } else {
              setError(detail || "Analysis failed");
            }
          }
        }
      } catch {
        // ponytail: don't stop polling on transient network errors — the background job may still be running
      }
    }, 1000);
  }, [alertId]);

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const res = await fetch(`/api/alerts/${alertId}/analysis`);
        if (!res.ok || canceled) return;
        const result = (await res.json()) as { data: AnalysisItem[]; progress?: QueueProgress };
        const { data, progress: prog } = result;
        if (!canceled) {
          setProgress(prog ?? null);
          if (data && data.length > 0 && data[0]) {
            setVerdict(data[0].verdict);
          } else if (!prog || prog.status === "done") {
            // No verdict yet and no running job — stay in empty state
          } else {
            // Job is already in progress (queued/loading/processing) — start polling
            startPolling();
          }
        }
      } catch {
        // ponytail: silently ignore network fetch failures on load; let user manually trigger analysis if needed
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [alertId, startPolling]);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enrich: true }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; upstreamStatus?: number };
        };
        const code = payload?.error?.code ?? `Request failed with status ${res.status}`;
        const upstream = payload?.error?.upstreamStatus;
        throw new Error(upstream ? `${code} (provider ${upstream})` : code);
      }
      // 202 accepted — start polling for completion
      startPolling();
    } catch (err) {
      // ponytail: on POST error, check if a progress row already exists before declaring failure.
      // This handles the case where setQueuePhase succeeded but the response timed out.
      try {
        const checkRes = await fetch(`/api/alerts/${alertId}/analysis`);
        if (checkRes.ok) {
          const checkResult = (await checkRes.json()) as { progress?: QueueProgress };
          const prog = checkResult.progress;
          if (prog && prog.status !== "done" && prog.status !== "error") {
            // A job is already queued/running — start polling instead of showing error
            startPolling();
            return;
          }
        }
      } catch {
        // Ignore; fall through to error display
      }
      setError(err instanceof Error ? err.message : "Analysis failed");
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  const handleCreateCase = async () => {
    if (!verdict) return;
    setCreatingCase(true);
    setCaseMessage(null);
    try {
      const res = await fetch(`/api/alerts/${alertId}/ir-case`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verdict }),
      });
      if (!res.ok) throw new Error("Failed to create IR Case");
      const { data } = (await res.json()) as { data: { incidentId: string; incidentNumber: string } };
      setCaseMessage(`Case created: ${data.incidentNumber}`);
      setTimeout(() => {
        window.location.href = `/incidents/${data.incidentId}`;
      }, 1000);
    } catch (err) {
      setCaseMessage(err instanceof Error ? err.message : "Error creating case");
    } finally {
      setCreatingCase(false);
    }
  };

  return (
    <section className="panel detail-section alert-analysis-panel" data-testid="alert-analysis-panel">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
        <h2 style={{ flex: "1 1 auto", minWidth: 0 }}>AI SOC Analysis</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          {verdict && (
            <button type="button" className="btn-secondary" onClick={() => setLanguage((current) => current === "en" ? "th" : "en")} aria-label="Switch analysis language">
              <Languages size={14} /> {language === "en" ? "ไทย" : "English"}
            </button>
          )}
          {verdict && (
            <button
              onClick={handleCreateCase}
              disabled={creatingCase}
              className="btn-secondary"
              aria-label="Create incident report case"
            >
              {creatingCase ? "Creating..." : "Create IR Case"}
            </button>
          )}
          {canAnalyze && (
            <button onClick={handleAnalyze} disabled={loading} className="btn-primary" data-testid="analyze-btn">
              {loading ? progress?.phase === "loading" || progress?.phase === "processing" ? "Processing..." : "Queued..." : "Analyze"}
            </button>
          )}
        </div>
      </div>
      {caseMessage && (
        <div role="status" style={{ marginBottom: "0.5rem", fontSize: "0.875rem", color: caseMessage.startsWith("Error") ? "var(--color-danger)" : "var(--color-success)" }}>
          {caseMessage}
        </div>
      )}
      {error && (
        <div role="alert" className="alert-error" style={{ color: "var(--color-danger)", marginBottom: "0.5rem" }}>
          {error}
        </div>
      )}
      {!verdict && !loading && !error && (
        <p className="muted" data-testid="empty-verdict">No analysis available.</p>
      )}
      {loading && progress && (
        <p className="muted" data-testid="analysis-progress" role="status">
          {progress.phase === "loading" ? "Preparing analysis..." : progress.phase === "processing" ? "Analyzing alert..." : "Processing..."}
        </p>
      )}
      {verdict && (
        <div className="verdict-content" data-testid="verdict-content">
          <p><strong>{language === "en" ? "Summary (English):" : "สรุป (ไทย):"}</strong> {language === "en" ? (verdict.summaryEn ?? verdict.summary) : (verdict.summaryTh ?? verdict.summary)}</p>
          {(language === "en" ? verdict.attackExplanationEn : verdict.attackExplanationTh) && (
            <p><strong>{language === "en" ? "Attack explanation:" : "คำอธิบายวิธีการโจมตี:"}</strong> {language === "en" ? verdict.attackExplanationEn : verdict.attackExplanationTh}</p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.5rem" }}>
            {verdict.severity && <span><strong>Severity:</strong> {verdict.severity}</span>}
            <span><strong>Confidence:</strong> {Math.round(verdict.confidence * 100)}%</span>
            {verdict.likelyFalsePositive !== undefined && (
              <span><strong>False Positive:</strong> {verdict.likelyFalsePositive ? "Yes" : "No"}</span>
            )}
            {verdict.threatIntel?.score !== undefined && (
              <span><strong>TI Score:</strong> {verdict.threatIntel.score}/100</span>
            )}
          </div>
          {verdict.mitreAttack && verdict.mitreAttack.length > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <strong>MITRE ATT&CK (Wazuh): </strong>
              {verdict.mitreAttack.map((t) => (
                <span key={t.techniqueId} className="group-badge" style={{ marginRight: "0.25rem" }}>
                  {t.techniqueId} {t.techniqueName && `(${t.techniqueName})`}
                </span>
              ))}
            </div>
          )}
          {(language === "en" ? (verdict.recommendedActionsEn ?? verdict.recommendedActions) : (verdict.recommendedActionsTh ?? verdict.recommendedActions))?.length ? (
            <div style={{ marginTop: "0.5rem" }}>
              <strong>{language === "en" ? "Recommended Actions:" : "การดำเนินการที่แนะนำ:"}</strong>
              {(language === "th" && !verdict.recommendedActionsTh) ? (
                <p className="muted">ยังไม่มีคำแนะนำภาษาไทยที่ผ่านการตรวจสอบ กรุณากด Analyze อีกครั้ง</p>
              ) : (
                <ul style={{ margin: "0.25rem 0", paddingLeft: "1.25rem" }}>
                  {(language === "en" ? (verdict.recommendedActionsEn ?? verdict.recommendedActions) : verdict.recommendedActionsTh)?.map((act, i) => (
                    <li key={i}>{act}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
          {verdict.remediation && verdict.remediation.length > 0 && !verdict.recommendedActions && (
            <div style={{ marginTop: "0.5rem" }}>
              <strong>Remediation:</strong>
              <ul style={{ margin: "0.25rem 0", paddingLeft: "1.25rem" }}>
                {verdict.remediation.map((rem, i) => (
                  <li key={i}>{rem}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
