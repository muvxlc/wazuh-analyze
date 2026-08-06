import { describe, expect, it, vi } from "vitest";
import { createChatProvider } from "./connections";

describe("OpenAI-compatible chat provider", () => {
  it("calls Agnes-compatible /v1/chat/completions with messages and bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 }),
    );
    const provider = createChatProvider({
      provider: "openai_compatible",
      baseUrl: "https://apihub.agnes-ai.com/v1",
      model: "agnes-2.5-flash",
      apiKey: "secret",
      timeoutMs: 10_000,
    }, fetchMock as unknown as typeof fetch);

    await expect(provider.chat("system", "user")).resolves.toBe("hello");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://apihub.agnes-ai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ authorization: "Bearer secret", "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: "agnes-2.5-flash",
      messages: [{ role: "system", content: "system" }, { role: "user", content: "user" }],
    });
  });

  it("uses LM Studio native endpoint for local connections", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output: [{ type: "message", content: "pong" }] }), { status: 200 }),
    );
    const provider = createChatProvider({
      provider: "lm_studio",
      baseUrl: "http://localhost:1234",
      model: "local-model",
      apiKey: "",
      timeoutMs: 10_000,
    }, fetchMock as unknown as typeof fetch);

    await expect(provider.chat("system", "user")).resolves.toBe("pong");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:1234/api/v1/chat");
  });
});
