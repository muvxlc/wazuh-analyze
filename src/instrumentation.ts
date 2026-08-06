import { loadConfig } from "./server/config";
import { startDaemon } from "./server/daemon/runner";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[Instrumentation] Node.js runtime detected, initializing background services...");
    const config = loadConfig(process.env);
    // Auto-start daemon in the background
    startDaemon(config);
  }
}
