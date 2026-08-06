"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AgentTable } from "../../../components/agents/agent-table";
import type { AgentSnapshot } from "../../../server/wazuh/types";
import type { AgentTag } from "../../../server/wazuh/agent-tags";

interface SessionInfo {
  permissions?: string[];
}

export default function AgentsPage() {
  const t = useTranslations("agents");
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [agentTags, setAgentTags] = useState<Record<string, AgentTag[]>>({});
  const [canManageAgents, setCanManageAgents] = useState(false);
  useEffect(() => {
    void fetch("/api/agents")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { data: AgentSnapshot }) => {
        setSnapshot(body.data);
        setAgentTags(body.data.agentTags ?? {});
      })
      .catch(() => setSnapshot({ agents: [], syncedAt: new Date(), stale: true, upstreamErrorCode: "unavailable" }));
    void fetch("/api/auth/session")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { data: SessionInfo }) => {
        if (body.data?.permissions?.includes("agents.manage")) setCanManageAgents(true);
      })
      .catch(() => {
        // Permission unknown — default to read-only tag view.
      });
  }, []);

  const connectionStatus = snapshot?.stale ? "disconnected" : "connected";
  const statusLabel = snapshot ? t(`wazuh-${connectionStatus}`) : t("loading");

  return (
    <section className="page-section space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">Wazuh inventory</p>
          <h1 className="mb-0">Agents</h1>
        </div>
        {snapshot && (
          <div
            className={`wazuh-status wazuh-status-${connectionStatus}`}
            aria-label={`Wazuh ${connectionStatus}: ${snapshot.upstreamErrorCode ?? (snapshot.stale ? "unavailable" : "reachable")}`}
          >
            <span className="wazuh-status-dot" aria-hidden="true" />
            <span>Wazuh: <strong>{statusLabel}</strong></span>
          </div>
        )}
      </header>
      {snapshot ? (
        <AgentTable
          agents={snapshot.agents}
          stale={snapshot.stale}
          errorCode={snapshot.upstreamErrorCode}
          agentTags={agentTags}
          showTags={canManageAgents}
          canManageTags={canManageAgents}
          onTagsChange={(agentId, tags) =>
            setAgentTags((prev) => ({ ...prev, [agentId]: tags }))
          }
        />
      ) : (
        <p className="panel p-4" role="status">
          {t("loading")}
        </p>
      )}
    </section>
  );
}
