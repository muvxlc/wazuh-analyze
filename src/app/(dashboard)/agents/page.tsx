"use client";

import { useEffect, useState } from "react";
import { AgentTable } from "../../../components/agents/agent-table";
import type { AgentSnapshot } from "../../../server/wazuh/types";

export default function AgentsPage() {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  useEffect(() => { void fetch("/api/agents").then((response) => response.ok ? response.json() : Promise.reject()).then((body: { data: AgentSnapshot }) => setSnapshot(body.data)).catch(() => setSnapshot({ agents: [], syncedAt: new Date(), stale: true, upstreamErrorCode: "unavailable" })); }, []);
  return <section><h1>Agents</h1>{snapshot ? <AgentTable agents={snapshot.agents} stale={snapshot.stale} /> : <p role="status">Loading agents</p>}</section>;
}
