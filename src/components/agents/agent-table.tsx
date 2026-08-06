import type { WazuhAgent } from "../../server/wazuh/types";

export function AgentTable({ agents, stale = false }: { agents: readonly WazuhAgent[]; stale?: boolean }) {
  if (agents.length === 0) return <p>{stale ? "unavailable" : "empty"}</p>;
  return <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse" }}><caption className="sr-only">Wazuh agents</caption><thead><tr><th align="left">Name</th><th align="left">Status</th><th align="left">IP</th><th align="left">Version</th><th align="left">Last keepalive</th></tr></thead><tbody>{agents.map((agent) => <tr key={agent.id}><td>{agent.name} <small>({agent.id})</small></td><td>{agent.status}</td><td>{agent.ip}</td><td>{agent.version}</td><td>{agent.lastKeepAlive ?? "-"}</td></tr>)}</tbody></table></div>;
}
