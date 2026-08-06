"use client";

import { useState, useEffect } from "react";
import type { AiVerdict } from "../../server/ai/analysis";

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

  useEffect(() => {
    let canceled = false;
    async function load() {
      try {
        const res = await fetch(`/api/alerts/${alertId}/analysis`);
        if (!res.ok || canceled) return;
        const { data } = (await res.json()) as { data: AnalysisItem[] };
        if (!canceled && data && data.length > 0 && data[0]) {
          setVerdict(data[0].verdict);
        }
      } catch {
        // ponytail: silently ignore network fetch failures on load; let user manually trigger analysis if needed
      }
    }
    void load();
    return () => {
      canceled = true;
    };
  }, [alertId]);

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
        const payload = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
        throw new Error(payload?.error?.code ?? `Request failed with status ${res.status}`);
      }
      const { data } = (await res.json()) as { data: { verdict: AiVerdict } };
      setVerdict(data.verdict);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel detail-section alert-analysis-panel" data-testid="alert-analysis-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2>AI SOC Analysis</h2>
        {canAnalyze && (
          <button onClick={handleAnalyze} disabled={loading} className="btn-primary" data-testid="analyze-btn">
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="alert-error" style={{ color: "red", marginBottom: "0.5rem" }}>
          {error}
        </div>
      )}
      {!verdict && !loading && !error && (
        <p className="muted" data-testid="empty-verdict">No analysis available.</p>
      )}
      {verdict && (
        <div className="verdict-content" data-testid="verdict-content">
          <p><strong>Summary:</strong> {verdict.summary}</p>
          <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
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
              <strong>MITRE ATT&CK: </strong>
              {verdict.mitreAttack.map((t) => (
                <span key={t.techniqueId} className="group-badge" style={{ marginRight: "0.25rem" }}>
                  {t.techniqueId} {t.techniqueName && `(${t.techniqueName})`}
                </span>
              ))}
            </div>
          )}
          {verdict.recommendedActions && verdict.recommendedActions.length > 0 && (
            <div style={{ marginTop: "0.5rem" }}>
              <strong>Recommended Actions:</strong>
              <ul style={{ margin: "0.25rem 0", paddingLeft: "1.25rem" }}>
                {verdict.recommendedActions.map((act, i) => (
                  <li key={i}>{act}</li>
                ))}
              </ul>
            </div>
          )}
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
