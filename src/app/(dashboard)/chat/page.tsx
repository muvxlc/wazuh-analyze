"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Bot, Send, User } from "lucide-react";

interface ChatConnection {
  id: string | null;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

// ponytail: no streaming/persistence yet — client holds turn history and folds it
// into one input string per request, since /api/v1/chat takes system_prompt + input.
// Upgrade path: add a messages-aware endpoint + SSE streaming when LM Studio supports it.
const SYSTEM_PROMPT =
  "You are a helpful security operations assistant for a Wazuh dashboard. " +
  "Answer in clear, concise text. If context is missing, say what information is needed. " +
  "The conversation history is provided below as alternating user/assistant turns.";

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ChatConnection[]>([]);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch("/api/v1/chat")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { data: ChatConnection[] }) => {
        setConnections(body.data);
        const defaultConnection = body.data.find((connection) => connection.isDefault) ?? body.data[0];
        setConnectionId(defaultConnection?.id ?? null);
      })
      .catch(() => setError("Failed to load AI connections"));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setError(null);
    setLoading(true);
    try {
      const context = next.map((m) => `${m.role}: ${m.content}`).join("\n\n");
      const response = await fetch("/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: window.location.origin },
        body: JSON.stringify({ system_prompt: SYSTEM_PROMPT, input: context, connection_id: connectionId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { data?: { content?: string } };
      const content = body.data?.content?.trim();
      if (!content) throw new Error("Empty AI response");
      setMessages((current) => [...current, { role: "assistant", content }]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chat request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-section flex min-h-[calc(100vh-112px)] flex-col gap-6">
      <header>
        <p className="mb-2 text-sm font-medium text-[var(--color-primary-deep)]">AI assistant</p>
        <h1 className="mb-0">Chatbot</h1>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="chat-connection" className="text-sm text-[var(--color-ink-muted)]">AI connection</label>
          <select
            id="chat-connection"
            value={connectionId ?? ""}
            onChange={(event) => setConnectionId(event.target.value || null)}
            className="min-w-64"
            disabled={connections.length === 0 || loading}
          >
            {connections.length === 0 && <option value="">No AI connection</option>}
            {connections.map((connection) => (
              <option key={connection.id ?? "legacy"} value={connection.id ?? ""}>
                {connection.name} · {connection.model}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="panel flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6" aria-live="polite">
          {messages.length === 0 && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-[var(--color-ink-muted)]">
              <Bot size={32} aria-hidden="true" />
              <p>Ask about Wazuh alerts, agents, or security operations.</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {message.role === "assistant" && (
                <Bot className="mt-2 shrink-0 text-[var(--color-primary-deep)]" size={18} aria-hidden="true" />
              )}
              <p
                className={`max-w-[min(720px,85%)] whitespace-pre-wrap rounded-[var(--radius-compact)] px-4 py-3 text-sm ${
                  message.role === "user" ? "bg-[var(--color-primary)]" : "bg-[var(--color-canvas-soft)]"
                }`}
              >
                {message.content}
              </p>
              {message.role === "user" && (
                <User className="mt-2 shrink-0 text-[var(--color-ink-muted)]" size={18} aria-hidden="true" />
              )}
            </div>
          ))}
          {loading && (
            <p className="text-sm text-[var(--color-ink-muted)]" role="status">
              AI is replying...
            </p>
          )}
          <div ref={endRef} />
        </div>
        {error && (
          <p className="status-error mx-4 mb-3 p-3 text-sm" role="alert">
            {error}
          </p>
        )}
        <form suppressHydrationWarning onSubmit={submit} className="flex gap-2 border-t border-[var(--color-hairline)] p-4">
          <label className="sr-only" htmlFor="chat-input">
            Message
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(event);
              }
            }}
            placeholder="Type your message..."
            rows={2}
            className="min-h-12 flex-1 resize-none"
            disabled={loading}
          />
          <button
            type="submit"
            aria-label="Send message"
            title="Send message"
            disabled={loading || !input.trim()}
            className="self-end px-3"
          >
            <Send size={18} aria-hidden="true" />
          </button>
        </form>
      </div>
    </section>
  );
}
