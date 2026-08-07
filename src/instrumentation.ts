/**
 * Next.js instrumentation hook — runs once on server startup.
 * Must avoid importing Node-only modules (node:crypto, pg) at the top level,
 * because Next.js bundles this file for BOTH the Node.js and Edge runtimes.
 * Guard + dynamic import keeps Edge bundle clean.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfig } = await import("./server/config");
    const { startDaemon } = await import("./server/daemon/runner");
    console.log("[Instrumentation] Node.js runtime detected, initializing background services...");
    const config = loadConfig(process.env);
    startDaemon(config);
  }
}
