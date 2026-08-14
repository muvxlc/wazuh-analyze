import type { WazuhAgent } from "../../server/wazuh/types";
import type { AgentTag } from "../../server/wazuh/agent-tags";
import { AgentTagEditor } from "./agent-tag-editor";
import { toBangkokDate } from "../../lib/bangkok-date";

interface AgentTableProps {
  agents: readonly WazuhAgent[];
  stale?: boolean;
  errorCode?: string | null;
  agentTags?: Record<string, AgentTag[]>;
  showTags?: boolean;
  canManageTags?: boolean;
  /** Propagated to each AgentTagEditor so the parent can sync its snapshot. */
  onTagsChange?: (agentId: string, tags: AgentTag[]) => void;
}

export function AgentTable({
  agents,
  stale = false,
  errorCode = null,
  agentTags = {},
  showTags = false,
  canManageTags = false,
  onTagsChange,
}: AgentTableProps) {
  if (agents.length === 0) {
    return (
      <div className="panel space-y-2 p-6" role="status">
        <h2>{stale ? "Wazuh not connected" : "No agents"}</h2>
        <p className="text-sm text-[var(--color-ink-muted)]">
          {stale ? `Wazuh agent inventory unavailable${errorCode ? `: ${errorCode}` : ""}.` : "No agents registered in Wazuh."}
        </p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <caption className="sr-only">Wazuh agents</caption>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>IP</th>
            <th>Version</th>
            <th>Last keep alive</th>
            <th>Wazuh groups</th>
            {showTags && <th>Tags</th>}
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const keepAlive = toBangkokDate(agent.lastKeepAlive);
            return (
              <tr key={agent.id}>
                <td className="max-w-[160px] truncate">{agent.name} <small>({agent.id})</small></td>
                <td>{agent.status}</td>
                <td>{agent.ip}</td>
                <td>{agent.version}</td>
                <td>{keepAlive ?? "-"}</td>
                <td className="max-w-[180px] truncate">{agent.groups?.length ? agent.groups.join(", ") : "-"}</td>
                {showTags && (
                  <td className="max-w-[200px]">
                    <AgentTagEditor
                      key={agent.id}
                      agentId={agent.id}
                      initialTags={agentTags[agent.id] ?? []}
                      readOnly={!canManageTags}
                      onChange={(tags) => onTagsChange?.(agent.id, tags)}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
